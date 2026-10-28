import {
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'
import { parseCatalogSearch } from '@/features/catalog/catalog-search'
import { Route as rootRoute } from '../routes/__root'
import { Route as indexRoute } from '../routes/index'
import { queryClient } from './query-client'

const customerPages = () => import('../features/commerce/customer-pages')
const orderPages = () => import('../features/commerce/order-pages')
const staffPages = () => import('../features/commerce/staff-pages')

const routeTree = rootRoute.addChildren([
  indexRoute,
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/products',
    validateSearch: parseCatalogSearch,
    component: lazyRouteComponent(customerPages, 'CatalogPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: lazyRouteComponent(customerPages, 'AuthPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    beforeLoad: ({ search }) => {
      throw redirect({ to: '/admin/login', search, replace: true })
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/login',
    component: lazyRouteComponent(
      () => import('../features/admin-auth/admin-login-page'),
      'AdminLoginPage',
    ),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/cart',
    component: lazyRouteComponent(customerPages, 'CartPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/checkout',
    component: lazyRouteComponent(customerPages, 'CheckoutPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/orders',
    component: lazyRouteComponent(customerPages, 'CustomerOrdersPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/orders/$orderId',
    component: lazyRouteComponent(orderPages, 'CustomerOrderPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/orders/$orderId/payment',
    component: lazyRouteComponent(orderPages, 'BankTransferPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/staff/orders',
    component: lazyRouteComponent(staffPages, 'StaffOrdersPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/staff/fulfillment',
    component: lazyRouteComponent(staffPages, 'StaffOrdersPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/staff/orders/$orderId',
    component: lazyRouteComponent(staffPages, 'StaffFulfillmentPage'),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/staff/payments',
    component: lazyRouteComponent(
      () => import('../features/commerce/finance-page'),
      'FinancePage',
    ),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/staff/returns',
    component: lazyRouteComponent(
      () => import('../features/commerce/returns-page'),
      'StaffReturnsPage',
    ),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/staff/team',
    component: lazyRouteComponent(
      () => import('../features/commerce/team-page'),
      'TeamPage',
    ),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/staff/receiving-accounts',
    component: lazyRouteComponent(
      () => import('../features/commerce/receiving-accounts-page'),
      'ReceivingAccountsPage',
    ),
  }),
])

export const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
