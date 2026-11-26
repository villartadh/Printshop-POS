import express from 'express';
import { adminRouter } from './routes/adminRoutes.ts';
import { authRouter } from './routes/authRoutes.ts';
import { catalogRouter } from './routes/catalogRoutes.ts';
import { inventoryRouter } from './routes/inventoryRoutes.ts';
import { posRouter } from './routes/posRoutes.ts';
import { supplierRouter } from './routes/supplierRoutes.ts';

export const apiRouter = express.Router();

apiRouter.use(authRouter);
apiRouter.use(catalogRouter);
apiRouter.use(posRouter);
apiRouter.use(inventoryRouter);
apiRouter.use(supplierRouter);
apiRouter.use(adminRouter);
