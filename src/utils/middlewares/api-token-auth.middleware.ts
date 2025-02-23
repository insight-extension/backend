import { NestMiddleware } from '@nestjs/common';
import 'dotenv/config';
import { NextFunction, Request, Response } from 'express';

/*
 * Middleware to authenticate API requests using a token
 * for protected admin-only routes
 */

export class ApiTokenAuthMiddleware implements NestMiddleware {
  private readonly validToken = process.env.ADMIN_AUTH_TOKEN;

  use(req: Request, res: Response, next: NextFunction): void {
    // Extract the token from the Authorization header
    const authHeader = req.headers.authorization;

    // Check if the header is present and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).send('Unauthorized');
      return;
    }

    // Extract token from header without 'Bearer '
    const token = authHeader.split(' ')[1];

    // Check if the token is valid
    if (token !== this.validToken) {
      res.status(401).send('Unauthorized');
      return;
    }
    // Continue processing the request
    next();
  }
}
