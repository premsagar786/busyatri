import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import campusRouter from "./campus";
import driverRouter from "./driver";
import healthRouter from "./health";
import routeMapRouter from "./route-map";

const router: IRouter = Router();

router.use(healthRouter);
router.use(campusRouter);
router.use(routeMapRouter);
router.use(driverRouter);
router.use(adminRouter);

export default router;
