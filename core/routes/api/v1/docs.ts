import type { InitializedCtx } from '@modules/WebServer/ctxTypes';

const SWAGGER_VERSION = '5.17.14';
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}`;
//Subresource integrity of the pinned files (sha384 of the npm package contents). The page takes API
//keys in its Authorize dialog, so the browser must refuse a swapped CDN asset. Recompute on a bump:
//  openssl dgst -sha384 -binary node_modules/swagger-ui-dist/<file> | openssl base64 -A
const CSS_SRI = 'sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn';
const JS_SRI = 'sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep';

const page = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>txAdmin API</title>
    <link rel="stylesheet" href="${CDN}/swagger-ui.css" integrity="${CSS_SRI}" crossorigin="anonymous">
    <style>body { margin: 0; } .swagger-ui .topbar { display: none; }</style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="${CDN}/swagger-ui-bundle.js" integrity="${JS_SRI}" crossorigin="anonymous"></script>
    <script>
        window.ui = SwaggerUIBundle({
            url: new URL('openapi.json', location.href).toString(),
            dom_id: '#swagger-ui',
            persistAuthorization: true,
            tryItOutEnabled: true,
            displayRequestDuration: true,
        });
    </script>
</body>
</html>
`;

/**
 * GET /api/v1/docs
 * Unauthenticated Swagger UI over /api/v1/openapi.json. Calls made from the page use the key
 * typed into its Authorize dialog, so the page itself exposes nothing.
 */
export default async function docs(ctx: InitializedCtx) {
    ctx.set('Cache-Control', 'public, max-age=300');
    ctx.type = 'text/html; charset=utf-8';
    ctx.status = 200;
    ctx.body = page;
};
