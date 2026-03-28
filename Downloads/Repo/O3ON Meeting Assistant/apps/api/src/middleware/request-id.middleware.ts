import { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const requestId = (request.headers["x-request-id"] as string) || crypto.randomUUID();
  request.headers["x-request-id"] = requestId;
  response.setHeader("X-Request-Id", requestId);
  next();
}
