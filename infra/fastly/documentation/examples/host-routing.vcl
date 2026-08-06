# Optional future dedicated-host routing model.
# Public: https://docs.pulse-compute.example/...
# Object: s3://<bucket>/pulse/...
# Placement: vcl_recv, before routing.vcl's path rule.

if (req.http.host == "DOCS_HOSTNAME") {
  set req.backend = F_pulse_documentation_storage;
  set req.http.Pulse-Documentation = "1";
  set req.http.Pulse-Documentation-Public-Path = req.url.path;
  unset req.http.Cookie;
  set req.url = querystring.remove(req.url);

  if (req.method != "GET" && req.method != "HEAD") {
    error 405 "Method Not Allowed";
  }
  if (req.url.path !~ "/$" && req.url.path !~ "\\.[A-Za-z0-9]{1,12}$") {
    error 752 "Pulse documentation directory redirect";
  }
  if (req.url.path ~ "/$") {
    set req.url = req.url.path "index.html";
  }

  # A dedicated host omits /pulse publicly, so add the storage prefix
  # before origin-signing.vcl adds the bucket name. A branded-404 restart has
  # already selected the storage-prefixed object and must not be prefixed twice.
  if (req.http.Pulse-Documentation-404 != "1") {
    set req.url = "/pulse" req.url;
  }
  return(lookup);
}
