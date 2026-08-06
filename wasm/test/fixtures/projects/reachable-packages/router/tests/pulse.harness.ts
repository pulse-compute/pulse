export default {
  cases: [
    {
      name: 'label',
      request: { method: 'GET', path: '/label' },
      expect: { status: 200, text: 'reachable-package' },
    },
  ],
}
