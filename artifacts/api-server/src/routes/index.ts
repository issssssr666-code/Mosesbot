import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mosesRouter from "./moses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mosesRouter);

export default router;
