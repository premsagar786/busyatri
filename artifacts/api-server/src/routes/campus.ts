import { Router, type IRouter } from "express";
import { GetCampusResponse, GetMeResponse } from "@workspace/api-zod";
import { requireUser } from "../middlewares/currentUser";
import { getProfile, loadBusSnapshot } from "./transport-data";

const router: IRouter = Router();

router.get("/me", requireUser, async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  res.json(GetMeResponse.parse(await getProfile(user)));
});

router.get("/campus", requireUser, async (_req, res): Promise<void> => {
  const response = {
    collegeName: "Campus transport",
    buses: await loadBusSnapshot(),
  };
  res.json(GetCampusResponse.parse(response));
});

export default router;
