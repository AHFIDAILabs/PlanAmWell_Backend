// routes/videoCall.ts

import { Router } from 'express';
import { generateVideoToken, endVideoCall, reportCallIssue, getCallStatus } from '../controllers/videoCallController';
import { verifyToken, authorize, guestAuth } from '../middleware/auth';
import { vi } from '@faker-js/faker/.';

const videoRouter = Router();

videoRouter.post(
  '/token', guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  generateVideoToken
);

videoRouter.post(
  '/end-call',
 guestAuth, verifyToken,
  authorize('Doctor'),
  endVideoCall
);

videoRouter.post(
  '/report-issue',
   guestAuth, verifyToken, 
  authorize('Doctor', 'User'),
  reportCallIssue
);

videoRouter.get(
  '/call-status/:appointmentId',
  guestAuth, verifyToken,
  authorize('Doctor', 'User'),
  getCallStatus
);

export default videoRouter;

