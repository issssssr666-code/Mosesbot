import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mosesRouter from "./moses";
import forumRouter from "./forum";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mosesRouter);
router.use(forumRouter);

export default router;
