import { createLogger, transports, format, Logger } from "winston";

// Configure Winston logger
const logger: Logger = createLogger({
  level: "info", // default level
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({ filename: "logs/error.log", level: "error" }),
    new transports.File({ filename: "logs/combined.log" })
  ],
  exitOnError: false, // do not exit on handled exceptions
});

export default logger;
