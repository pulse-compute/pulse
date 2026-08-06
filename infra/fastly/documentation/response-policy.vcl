# Pulse documentation response and error policy.
# Split these blocks into snippets for vcl_fetch, vcl_deliver, and vcl_error.

# vcl_fetch
if (req.http.Pulse-Documentation == "1") {
  if (beresp.status == 404) {
    # Restart once against the generated branded 404 object. The marker keeps
    # the second miss from looping. vcl_error then preserves the public 404.
    if (!req.http.Pulse-Documentation-404) {
      set req.http.Pulse-Documentation-404 = "1";
      set req.url = "/pulse/404.html";
      return(restart);
    }
  }

  if (req.url.path ~ "^/pulse/(?:v[0-9]+\\.[0-9]+\\.[0-9]+/|deployments/v[0-9]+\\.[0-9]+\\.[0-9]+\\.json$)") {
    set beresp.http.Cache-Control = "public, max-age=31536000, immutable";
    set beresp.ttl = 365d;
  } else {
    set beresp.http.Cache-Control = "public, max-age=60, stale-while-revalidate=300";
    set beresp.ttl = 60s;
    set beresp.stale_while_revalidate = 300s;
  }

  unset beresp.http.x-amz-id-2;
  unset beresp.http.x-amz-request-id;
  unset beresp.http.x-amz-version-id;
  unset beresp.http.Server;
}

# vcl_deliver
if (req.http.Pulse-Documentation == "1") {
  set resp.http.Content-Security-Policy = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
  set resp.http.Referrer-Policy = "strict-origin-when-cross-origin";
  set resp.http.X-Content-Type-Options = "nosniff";
  set resp.http.Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
  set resp.http.Strict-Transport-Security = "max-age=31536000";

  if (req.http.Pulse-Documentation-404 == "1") {
    set resp.status = 404;
    set resp.response = "Not Found";
    set resp.http.Cache-Control = "public, max-age=60";
  }
}

# vcl_error
if (obj.status == 751) {
  set obj.status = 308;
  set obj.response = "Permanent Redirect";
  set obj.http.Location = "/pulse/";
  synthetic {""};
  return(deliver);
}
if (obj.status == 752) {
  set obj.status = 308;
  set obj.response = "Permanent Redirect";
  set obj.http.Location = req.url.path "/";
  synthetic {""};
  return(deliver);
}
if (obj.status == 405) {
  set obj.http.Allow = "GET, HEAD";
  synthetic {"Method Not Allowed"};
  return(deliver);
}
