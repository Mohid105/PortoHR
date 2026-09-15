'use strict';

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { toMajor } = require('../utils/money');
const webhooks = require('./webhooks.service');
const { REQUEST_STATUSES, STATUS_LABELS } = require('../config/finance');
const {
  resolveViewerEmployee,
  canViewSensitive,
  canDecideFor,
  isSelf,
  visibleEmployeeIds,
  approvalScope,
} = require('./employeeAccess');

const NO_RECORD_MESSAGE =
  'Your login is not linked to an employee record yet. Ask HR to add you to Core HR.';

/** Stored in minor units, presented in major ones — as everywhere else. */
const MONEY_FIELDS = new Set(['amount', 'monthlyInstalment', 'finalInstalment']);

/**
 * Only plain objects are walked. ObjectIds and Dates are objects too, and
 * recursing into them would rebuild them as anonymous bags of internals.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function toMajorDeep(value, key) {
  if (Array.isArray(value)) return value.map((item) => toMajorDeep(item, key));

  if (isPlainObject(value)) {
    return Object.keys(value).reduce((acc, childKey) => {
      acc[childKey] = toMajorDeep(value[childKey], childKey);
      return acc;
    }, {});
  }

  if (typeof value === 'number' && MONEY_FIELDS.has(key)) return toMajor(value);
  return value;
}

function present(doc) {
  const json = toMajorDeep(doc.toJSON(), null);
  json.id = String(json.id || json._id);
  return json;
}

/**
 * Loans and compensation claims differ only in what a request contains. Raising,
 * scoping, deciding and withdrawing one are the same operation for both, so the
 * lifecycle is defined once here and each controller supplies its own payload
 * rules.
 *
 * @param {object}   options
 * @param {Model}    options.Model        Mongoose model backing the request.
 * @param {string}   options.label        Human name, used in messages.
 * @param {Function} options.buildPayload (body, employee) => fields, throwing ApiError when invalid.
 */
function createWorkflow(options) {
  const Model = options.Model;
  const label = options.label;
  const buildPayload = options.buildPayload;
  const event = options.event;
  const lower = label.toLowerCase();

  /** GET / — `scope=mine` for own history, `scope=queue` for things to approve. */
  const list = asyncHandler(async (req, res) => {
    const { status, scope } = req.query;

    const filter = {};
    if (status) {
      if (REQUEST_STATUSES.indexOf(status) === -1) {
        throw ApiError.badRequest(`Status must be one of: ${REQUEST_STATUSES.join(', ')}`);
      }
      filter.status = status;
    }

    const queue = await approvalScope(req.user);
    let sort = { createdAt: -1 };

    if (scope === 'queue') {
      // Nothing to approve is a normal state, not an error.
      if (!queue) {
        return res.json({ success: true, total: 0, pendingCount: 0, canApprove: false, requests: [] });
      }
      Object.assign(filter, queue);
      if (!status) filter.status = 'pending';
      // Oldest first: whoever has been waiting longest is dealt with first.
      sort = { createdAt: 1 };
    } else if (scope === 'mine') {
      const viewer = await resolveViewerEmployee(req.user);
      if (!viewer) throw ApiError.badRequest(NO_RECORD_MESSAGE);
      filter.employee = viewer._id;
    } else {
      const allowed = await visibleEmployeeIds(req.user);
      if (allowed) filter.employee = { $in: allowed };
    }

    const [requests, total, pendingCount] = await Promise.all([
      Model.find(filter).sort(sort).limit(200),
      Model.countDocuments(filter),
      queue ? Model.countDocuments(Object.assign({}, queue, { status: 'pending' })) : 0,
    ]);

    res.json({
      success: true,
      total,
      pendingCount,
      canApprove: Boolean(queue),
      requests: requests.map(present),
    });
  });

  /** GET /:id */
  const getOne = asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound(`${label} not found`);

    const request = await Model.findById(req.params.id);
    if (!request) throw ApiError.notFound(`${label} not found`);

    const employee = await Employee.findById(request.employee);
    const viewer = await resolveViewerEmployee(req.user);
    if (!employee || !canViewSensitive(req.user, viewer, employee)) {
      throw ApiError.forbidden(`You do not have access to this ${lower}`);
    }

    res.json({ success: true, request: present(request) });
  });

  /** POST / — always raised for the caller's own record. */
  const create = asyncHandler(async (req, res) => {
    const employee = await resolveViewerEmployee(req.user);
    if (!employee) throw ApiError.badRequest(NO_RECORD_MESSAGE);

    const payload = await buildPayload(req.body || {}, employee);

    const request = await Model.create(
      Object.assign(
        {
          employee: employee._id,
          currency: (employee.compensation && employee.compensation.currency) || 'USD',
          snapshot: {
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
            designation: employee.designation,
            department: employee.department,
          },
          submittedBy: req.user._id,
          status: 'pending',
        },
        payload
      )
    );

    res.status(201).json({
      success: true,
      message: `${label} submitted and waiting for approval`,
      request: present(request),
    });
  });

  /** PATCH /:id/status */
  const decide = asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound(`${label} not found`);

    const request = await Model.findById(req.params.id);
    if (!request) throw ApiError.notFound(`${label} not found`);

    if (request.status !== 'pending') {
      throw ApiError.conflict(
        `This ${lower} was already ${STATUS_LABELS[request.status].toLowerCase()} and cannot be decided again`
      );
    }

    const decision = (req.body || {}).status;
    if (['approved', 'rejected'].indexOf(decision) === -1) {
      throw ApiError.badRequest('A decision must be either approved or rejected');
    }

    const note = String((req.body || {}).decisionNote || '').trim();
    if (decision === 'rejected' && !note) {
      throw ApiError.badRequest('Please give a reason when rejecting a request');
    }

    const employee = await Employee.findById(request.employee);
    if (!employee) throw ApiError.notFound('Employee not found');

    const viewer = await resolveViewerEmployee(req.user);
    if (!(await canDecideFor(req.user, viewer, employee, event))) {
      throw ApiError.forbidden(
        isSelf(req.user, viewer, employee)
          ? `You cannot approve your own ${lower} — it needs a second pair of eyes`
          : `You are not the approver for this ${lower}`
      );
    }

    request.status = decision;
    request.decisionNote = note;
    request.decidedBy = req.user._id;
    request.decidedAt = new Date();
    await request.save();

    webhooks.emitApprovalCompleted({
      kind: event || lower,
      decision,
      objectId: request._id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
    });

    res.json({
      success: true,
      message: `${employee.fullName}'s ${lower} was ${STATUS_LABELS[decision].toLowerCase()}`,
      request: present(request),
    });
  });

  /** DELETE /:id — withdrawing a request you raised and nobody has acted on. */
  const withdraw = asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound(`${label} not found`);

    const request = await Model.findById(req.params.id);
    if (!request) throw ApiError.notFound(`${label} not found`);

    const employee = await Employee.findById(request.employee);
    const viewer = await resolveViewerEmployee(req.user);
    if (!employee || !isSelf(req.user, viewer, employee)) {
      throw ApiError.forbidden(`Only the person who raised a ${lower} can withdraw it`);
    }
    if (request.status !== 'pending') {
      throw ApiError.conflict(
        `This ${lower} was already ${STATUS_LABELS[request.status].toLowerCase()} and can no longer be withdrawn`
      );
    }

    await request.deleteOne();
    res.json({ success: true, message: `${label} withdrawn` });
  });

  return { list, getOne, create, decide, withdraw };
}

module.exports = { createWorkflow, present, NO_RECORD_MESSAGE };
