const body = $response.body;
if (!body || body.length === 0) {
  $done({});
  return;
}

if (body.includes('<head>')) {
  const script = '<script>console.log("[XVM] Script loaded");</script>';
  const injected = body.replace('<head>', '<head>' + script);
  $done({ body: injected });
} else {
  $done({});
}
