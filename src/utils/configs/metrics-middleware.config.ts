import {
  makeCounterProvider,
  makeSummaryProvider,
} from '@willsoto/nestjs-prometheus';
import { MetricNamesMiddleware } from '../middlewares/constants/metric-names-middleware.enum';
import { MetricLabelsMiddleware } from '../middlewares/constants/metric-labels-middleware.enum';

export const MetricsMiddlewareCounterProvider = makeCounterProvider({
  name: MetricNamesMiddleware.REQUESTS_TOTAL,
  help: 'Total number of requests',
  labelNames: Object.values(MetricLabelsMiddleware), // Get all labels
});

export const MetricsMiddlewareSummaryProvider = makeSummaryProvider({
  name: MetricNamesMiddleware.REQUEST_DURATION,
  help: 'Request duration in seconds',
  labelNames: Object.values(MetricLabelsMiddleware), // Get all labels
  maxAgeSeconds: 600,
  ageBuckets: 5,
});
