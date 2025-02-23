import { Injectable, NestMiddleware, RequestMethod } from '@nestjs/common';
import { Counter, Summary } from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { MetricNamesMiddleware } from './constants/metric-names-middleware.enum';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  private readonly appRoutes: Endpoint[];

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,

    // Inject the Prometheus metrics
    @InjectMetric(MetricNamesMiddleware.REQUESTS_TOTAL)
    private readonly requestCounter: Counter<string>,

    @InjectMetric(MetricNamesMiddleware.REQUEST_DURATION)
    private readonly requestDuration: Summary<string>,
  ) {
    this.appRoutes = this.getAllEndpoints();
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // Set request start time
    const start = process.hrtime();

    const route = req.originalUrl.split('?')[0]; // Clean the route from query parameters
    const method = req.method;

    // Check if the route exists in the application
    const routeExists = this.appRoutes.some((endpoint) => {
      return endpoint.path === route && endpoint.method === method;
    });
    if (!routeExists) {
      return next();
    }

    // Set response finish callback
    res.on('finish', () => {
      const duration = process.hrtime(start);
      const durationInSeconds = duration[0] + duration[1] / 1e9;
      const statusCode = res.statusCode.toString();

      // Set prometheus metrics
      this.requestCounter.inc({ method, route, status_code: statusCode });
      this.requestDuration.observe(
        { method, route, status_code: statusCode },
        durationInSeconds,
      );
    });

    // Continue processing the request
    next();
  }

  /*
   * This method retrieves all the endpoints in the application
   * and returns them in a structured format
   */
  private getAllEndpoints(): Endpoint[] {
    const getRoutes: Endpoint[] = []; // Array to store extracted route information
    const controllers = this.discoveryService.getControllers(); // Retrieve all registered controllers in the application

    controllers.forEach((wrapper) => {
      const { instance } = wrapper; // Extract the actual controller instance

      if (instance) {
        // Get the base path for the controller from metadata
        const controllerPath = this.reflector
          .get<string>(PATH_METADATA, instance.constructor)
          ?.trim(); // Trim to remove unnecessary spaces

        // Retrieve all method names defined in the controller
        const methods = Object.getOwnPropertyNames(
          Object.getPrototypeOf(instance),
        );

        methods.forEach((methodName) => {
          const methodHandler = instance[methodName]; // Get the method reference

          // Extract the path metadata for this specific method
          const methodPath = this.reflector
            .get<string>(PATH_METADATA, methodHandler)
            ?.trim(); // Trim to remove unnecessary spaces

          // Extract the HTTP request method (GET, POST, etc.) for this route
          const requestMethod = this.reflector.get<RequestMethod>(
            METHOD_METADATA,
            methodHandler,
          );

          // Construct the full base URI for this controller
          // Remove leading slashes from controllerPath to prevent double slashes in the final URL
          const baseUri = `/api/${controllerPath?.replace(/^\/+/, '')}`;
          const method = RequestMethod[requestMethod]; // Convert request method enum to string

          if (method) {
            getRoutes.push({
              // If methodPath is '/', use only baseUri, otherwise concatenate with methodPath
              // Also, remove any leading slashes in methodPath to avoid incorrect URLs
              path:
                methodPath === '/'
                  ? baseUri
                  : `${baseUri}/${methodPath.replace(/^\/+/, '')}`,
              method: method,
            });
          }
        });
      }
    });
    return getRoutes; // Return the list of all discovered endpoints with their HTTP methods
  }
}
