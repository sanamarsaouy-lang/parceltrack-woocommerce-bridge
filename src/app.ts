import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { healthRouter } from "./routes/health";
import { shipmentsRouter } from "./routes/shipments";
import { ordersRouter } from "./routes/orders";
import { adminRouter } from "./routes/admin";
import { errorHandler } from "./middleware/error-handler";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: "100kb" }));

  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests" },
      keyGenerator: (req) => {
        const auth = req.header("authorization") || "";
        return auth || req.ip || "anonymous";
      },
    })
  );

  app.use(healthRouter);
  app.use(shipmentsRouter);
  app.use(ordersRouter);
  app.use(adminRouter);

  app.use(errorHandler);
  return app;
}
