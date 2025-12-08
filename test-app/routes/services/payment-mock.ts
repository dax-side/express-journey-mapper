// Mock payment service - imported but might not be used in all handlers
export const paystack = {
  transaction: {
    initialize: async (data: any) => ({ status: true, data: { reference: 'ref123' } }),
    verify: async (reference: string) => ({ status: true, data: { amount: 5000 } })
  },
  charge: {
    create: async (data: any) => ({ status: true, data: { reference: 'charge123' } })
  }
};

export const stripe = {
  paymentIntents: {
    create: async (data: any) => ({ id: 'pi_123', client_secret: 'secret' }),
    confirm: async (id: string) => ({ id, status: 'succeeded' })
  }
};
