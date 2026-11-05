import { createHash, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'

const expectedSecretHash = env.API_PROXY_SECRET
  ? createHash('sha256').update(env.API_PROXY_SECRET).digest()
  : undefined

export function deploymentProxy(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('CDN-Cache-Control', 'no-store')
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store')

  const suppliedSecret = req.get('x-api-proxy-secret') ?? ''
  // Remove the credential before request logging and auth header conversion.
  delete req.headers['x-api-proxy-secret']
  if (!expectedSecretHash) {
    next()
    return
  }

  const suppliedSecretHash = createHash('sha256')
    .update(suppliedSecret)
    .digest()
  if (!timingSafeEqual(suppliedSecretHash, expectedSecretHash)) {
    res.status(403).json({
      error: { code: 'PROXY_REQUIRED', message: 'Use the storefront API URL' },
    })
    return
  }

  // Vercel overwrites x-real-ip. Trust it only after authenticating the proxy;
  // the Render/Vercel hop count otherwise groups unrelated visitors together.
  const clientIp = req.get('x-real-ip')
  if (!clientIp || isIP(clientIp) === 0) {
    res.status(400).json({
      error: {
        code: 'INVALID_PROXY_ADDRESS',
        message: 'The proxy must supply a valid client IP address',
      },
    })
    return
  }

  req.headers['x-forwarded-for'] = clientIp
  req.headers['x-forwarded-host'] = new URL(env.CLIENT_ORIGIN).host
  req.headers['x-forwarded-proto'] = 'https'
  delete req.headers.forwarded
  next()
}
