export async function blockAllRequests(page) {
  await page.route('**/*', async (route) => {
    await abortRoute(route);
  });
}

export async function allowSameOriginOnly(page, targetUrls, validateUrl) {
  const allowedOrigins = new Set(
    (Array.isArray(targetUrls) ? targetUrls : [targetUrls]).map((targetUrl) =>
      typeof targetUrl === 'string' ? targetUrl : targetUrl.origin
    )
  );
  let requestError = null;

  await page.route('**/*', async (route) => {
    try {
      const request = route.request();
      const reqUrl = new URL(request.url());
      if (validateUrl) {
        try {
          await validateUrl(reqUrl.href, request);
        } catch (e) {
          if (!requestError) requestError = e;
          await abortRoute(route);
          return;
        }
      }

      if (allowedOrigins.has(reqUrl.origin)) {
        const response = await route.fetch({ maxRedirects: 0 });
        const status = response.status();
        if (validateUrl && status >= 300 && status < 400) {
          const location = response.headers().location;
          if (location) {
            const redirectUrl = new URL(location, reqUrl.href);
            try {
              await validateUrl(redirectUrl.href, request);
            } catch (e) {
              if (!requestError) requestError = e;
              await abortRoute(route);
              return;
            }
          }
        }
        await route.fulfill({ response });
      } else {
        if (!requestError) {
          requestError = Object.assign(
            new Error(`Cross-origin request blocked: ${reqUrl.href}`),
            { exitCode: 2 }
          );
        }
        await abortRoute(route);
      }
    } catch (e) {
      if (!requestError) {
        requestError = e?.exitCode
          ? e
          : Object.assign(new Error(`Failed to validate request URL: ${e?.message || e}`), { exitCode: 2 });
      }
      await abortRoute(route);
    }
  });

  return {
    getError() {
      return requestError;
    },
  };
}

async function abortRoute(route) {
  try {
    await route.abort('blockedbyclient');
  } catch {
  }
}
