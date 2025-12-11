// routes/videoCall.ts

import { Router } from 'express';
import { generateVideoToken, endVideoCall } from '../controllers/videoCallController';
import { verifyToken, authorize, guestAuth } from '../middleware/auth';

const videoRouter = Router();

videoRouter.post(
  '/token', guestAuth,
  verifyToken,
  authorize('Doctor', 'User'),
  generateVideoToken
);

videoRouter.post(
  '/end-call',
  verifyToken, guestAuth,
  authorize('Doctor'),
  endVideoCall
);

export default videoRouter;

