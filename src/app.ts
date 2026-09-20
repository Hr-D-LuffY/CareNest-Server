import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import httpStatus from "http-status";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.status(httpStatus.OK).json({
    success: true,
    statusCode: httpStatus.OK,
    message: "CareNest server is running",
    data: {},
  });
});

app.get("/", (_req, res) => {
  res.status(httpStatus.OK).json({
    success: true,
    statusCode: httpStatus.OK,
    message: "Welcome to CareNest-Trusted care for your little ones",
  });
});

export default app;
