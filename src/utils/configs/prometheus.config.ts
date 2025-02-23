import { PrometheusModule } from '@willsoto/nestjs-prometheus';

export const PrometheusConfig = PrometheusModule.register({
  defaultLabels: {
    app: 'insight-prometheus',
  },
});
