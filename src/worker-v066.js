import worker from './worker-v065.js';

export default {
  async fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  }
};