import mongoose from 'mongoose';
import * as subAdminService from '../services/subAdmin.service.js';

export async function getPermissionModules(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const modules = subAdminService.getPermissionModules();
    res.status(200).json({
      success: true,
      message: 'Permission modules fetched successfully',
      data: { modules },
    });
  } catch (error) {
    next(error);
  }
}

export async function listSubAdmins(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const data = await subAdminService.listSubAdmins(req.query || {});
    res.status(200).json({
      success: true,
      message: 'Sub admins fetched successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getSubAdminById(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sub admin id' });
    }
    const subAdmin = await subAdminService.getSubAdminById(id);
    if (!subAdmin) {
      return res.status(404).json({ success: false, message: 'Sub admin not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Sub admin fetched successfully',
      data: { subAdmin },
    });
  } catch (error) {
    next(error);
  }
}

export async function createSubAdmin(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const subAdmin = await subAdminService.createSubAdmin(req.body || {});
    res.status(201).json({
      success: true,
      message: 'Sub admin created successfully',
      data: { subAdmin },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSubAdmin(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sub admin id' });
    }
    const subAdmin = await subAdminService.updateSubAdmin(id, req.body || {});
    if (!subAdmin) {
      return res.status(404).json({ success: false, message: 'Sub admin not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Sub admin updated successfully',
      data: { subAdmin },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSubAdminStatus(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sub admin id' });
    }
    const subAdmin = await subAdminService.updateSubAdminStatus(id, req.body?.isActive);
    if (!subAdmin) {
      return res.status(404).json({ success: false, message: 'Sub admin not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Sub admin status updated successfully',
      data: { subAdmin },
    });
  } catch (error) {
    next(error);
  }
}

export async function resetSubAdminPassword(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sub admin id' });
    }
    const newPassword = req.body?.newPassword ?? req.body?.password;
    const subAdmin = await subAdminService.resetSubAdminPassword(id, newPassword);
    if (!subAdmin) {
      return res.status(404).json({ success: false, message: 'Sub admin not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Password updated successfully',
      data: { subAdmin },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSubAdminPermissions(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sub admin id' });
    }
    const subAdmin = await subAdminService.updateSubAdminPermissions(id, req.body?.permissions);
    if (!subAdmin) {
      return res.status(404).json({ success: false, message: 'Sub admin not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Permissions saved successfully',
      data: { subAdmin },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteSubAdmin(req, res, next) {
  try {
    subAdminService.assertFullAdmin(req.user);
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid sub admin id' });
    }
    const subAdmin = await subAdminService.deleteSubAdmin(id);
    if (!subAdmin) {
      return res.status(404).json({ success: false, message: 'Sub admin not found' });
    }
    res.status(200).json({
      success: true,
      message: 'Sub admin deleted successfully',
      data: { subAdmin },
    });
  } catch (error) {
    next(error);
  }
}
