import { HttpInterceptorFn } from '@angular/common/http';

const NGROK_SKIP_HEADER = 'ngrok-skip-browser-warning';
const NGROK_HOST = /(^|\.)ngrok(-free)?\.(io|app|dev)$/i;

export const isNgrokUrl = (url: string): boolean => {
  try {
    const requestUrl = new URL(url, window.location.href);
    return NGROK_HOST.test(requestUrl.hostname);
  } catch {
    return false;
  }
};

export const ngrokInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isNgrokUrl(req.url)) {
    return next(req);
  }
  const modifiedRequest = req.clone({
    setHeaders: {
      [NGROK_SKIP_HEADER]: 'true',
    },
  });

  return next(modifiedRequest);
};
