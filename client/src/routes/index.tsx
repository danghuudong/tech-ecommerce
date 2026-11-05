import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { Route as rootRoute } from './__root'

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(
    () => import('../pages/home-v2/home-v2-page'),
    'HomeV2Page',
  ),
})
