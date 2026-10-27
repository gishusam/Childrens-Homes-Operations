import { Router, type IRouter } from "express";
import healthRouter from "./health";
import operationsRouter from "./operations";
import inventoryRouter from "./inventory";
import billsRouter from "./bills";
import issuesRouter from "./issues";
import reportsRouter from "./reports";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(operationsRouter);
router.use(inventoryRouter);
router.use(billsRouter);
router.use(issuesRouter);
router.use(reportsRouter);
router.use(storageRouter);

export default router;
