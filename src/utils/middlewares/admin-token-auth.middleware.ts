import { HttpStatus, Logger, NestMiddleware } from '@nestjs/common';
import 'dotenv/config';
import { NextFunction, Request, Response } from 'express';

/*
 * Middleware to authenticate API requests using a token
 * for protected admin-only routes
 */

export class AdminTokenAuthMiddleware implements NestMiddleware {
  private readonly validToken = process.env.ADMIN_AUTH_TOKEN;
  private readonly logger = new Logger(AdminTokenAuthMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    // Extract the token from the Authorization header
    const authHeader = req.headers.authorization;

    // Check if the header is present and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('Unauthorized request');
      res.status(HttpStatus.UNAUTHORIZED).send('Unauthorized');
      return;
    }

    // Extract token from header without 'Bearer '
    const token = authHeader.split(' ')[1];

    // Check if the token is valid
    if (token !== this.validToken) {
      this.logger.warn('Unauthorized request');
      res.status(HttpStatus.UNAUTHORIZED).send('Unauthorized');
      return;
    }
    this.logger.log('Authorized admin request');
    // Continue processing the request
    next();
  }
}
