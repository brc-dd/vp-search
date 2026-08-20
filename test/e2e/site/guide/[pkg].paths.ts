/**
 * Two dynamic routes, each with a token of its own. Only a build renders them,
 * so only a build's index can contain those tokens — DESIGN §11.
 */
export default {
  paths: () => [
    { params: { pkg: 'alfa', token: 'alfaroute2939' } },
    { params: { pkg: 'bravo', token: 'bravoroute2939' } },
  ],
}
