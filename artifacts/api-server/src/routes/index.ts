import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import campusRouter from "./campus";
import driverRouter from "./driver";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(campusRouter);
router.use(driverRouter);
router.use(adminRouter);

export default router;
