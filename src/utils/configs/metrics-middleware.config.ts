import {
  makeCounterProvider,
  makeSummaryProvider,
} from '@willsoto/nestjs-prometheus';
import { MetricNamesMiddleware } from '../middlewares/constants/metric-names-middleware.enum';
import { MetricLabelsMiddleware } from '../middlewares/constants/metric-labels-middleware.enum';

export const MetricsMiddlewareCounterProvider = makeCounterProvider({
  name: MetricNamesMiddleware.REQUESTS_TOTAL,
  help: 'Total number of requests',
  labelNames: [
    MetricLabelsMiddleware.METHOD,
    MetricLabelsMiddleware.ROUTE,
    MetricLabelsMiddleware.STATUS_CODE,
  ],
});

export const MetricsMiddlewareSummaryProvider = makeSummaryProvider({
  name: MetricNamesMiddleware.REQUEST_DURATION,
  help: 'Request duration in seconds',
  labelNames: [
    MetricLabelsMiddleware.METHOD,
    MetricLabelsMiddleware.ROUTE,
    MetricLabelsMiddleware.STATUS_CODE,
  ],
  maxAgeSeconds: 600,
  ageBuckets: 5,
});
