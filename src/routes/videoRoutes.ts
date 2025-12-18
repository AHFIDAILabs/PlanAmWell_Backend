// routes/videoCall.ts
import { Router } from 'express';
import {
  generateVideoToken,
  confirmCallJoin,
  updateParticipantHeartbeat,
  handleCallDisconnect,
  endVideoCall,
  getCallStatus,
  reportCallIssue,
} from '../controllers/videoCallController';
import { verifyToken, authorize, guestAuth } from '../middleware/auth';

const videoRouter = Router();

/**
 * @route   POST /api/v1/video/token
 * @desc    Generate Agora token and join/initiate call
 * @access  Private (Doctor | User)
 */
videoRouter.post(
  '/token',
  guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  generateVideoToken
);

/**
 * @route   POST /api/v1/video/join
 * @desc    Confirm that user has actually joined the Agora channel
 * @access  Private (Doctor | User)
 */
videoRouter.post(
  '/join',
  guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  confirmCallJoin
);

/**
 * @route   POST /api/v1/video/heartbeat
 * @desc    Send heartbeat to indicate participant is still active
 * @access  Private (Doctor | User)
 */
videoRouter.post(
  '/heartbeat',
  guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  updateParticipantHeartbeat
);

/**
 * @route   POST /api/v1/video/disconnect
 * @desc    Handle participant disconnect/leave
 * @access  Private (Doctor | User)
 */
videoRouter.post(
  '/disconnect',
  guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  handleCallDisconnect
);

/**
 * @route   POST /api/v1/video/end-call
 * @desc    End video call with optional quality feedback
 * @access  Private (Doctor | User)
 */
videoRouter.post(
  '/end-call',
  guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  endVideoCall
);

/**
 * @route   GET /api/v1/video/call-status/:appointmentId
 * @desc    Get current call status and appointment details
 * @access  Private (Doctor | User)
 */
videoRouter.get(
  '/call-status/:appointmentId',
  guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  getCallStatus
);

/**
 * @route   POST /api/v1/video/report-issue
 * @desc    Report technical issues with call
 * @access  Private (Doctor | User)
 */
videoRouter.post(
  '/report-issue',
  guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  reportCallIssue
);

export default videoRouter;