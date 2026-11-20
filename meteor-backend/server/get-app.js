/**
 * GET /get-app — the one link the web app's laptop install QR code holds
 * (#859). A phone that scans it is redirected straight to its own store, so a
 * single code serves iPhone and Android with no page in between. The response
 * itself is decided in get-app-core.js.
 */
import { WebApp } from 'meteor/webapp';
import { GET_APP_PATH } from '@timehuddle/app-links';

import { getAppResponse } from './get-app-core';

WebApp.connectHandlers.use(GET_APP_PATH, (req, res, next) => {
  // `use` also matches deeper paths; only the link itself is ours.
  const rest = (req.url || '/').split('?')[0];
  if (rest !== '/' || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

  const { status, headers, body } = getAppResponse(req.headers['user-agent'], req.method);
  res.writeHead(status, headers);
  res.end(body);
});
