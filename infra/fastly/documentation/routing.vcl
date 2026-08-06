# Pulse documentation path router
# Placement: vcl_recv, before the default backend selection.
#
# This checked-in snippet is a reviewed template. Replace the backend symbol
# and activate it through a human-reviewed Fastly service version.

if (req.url.path ~ "^/pulse(?:/|$)") {
  set req.backend = F_pulse_documentation_storage;
  set req.http.Pulse-Documentation = "1";

  if (req.method != "GET" && req.method != "HEAD") {
    error 405 "Method Not Allowed";
  }

  # Keep one canonical public URL for directory routes.
  if (req.url.path == "/pulse") {
    error 751 "Pulse documentation slash redirect";
  }

  if (req.url.path !~ "/$" && req.url.path !~ "\\.[A-Za-z0-9]{1,12}$") {
    error 752 "Pulse documentation directory redirect";
  }

  # The generated site stores directory pages as */index.html. The public URL
  # remains extensionless and the original path remains available to vcl_error.
  set req.http.Pulse-Documentation-Public-Path = req.url.path;
  unset req.http.Cookie;
  set req.url = querystring.remove(req.url);
  if (req.url.path ~ "/$") {
    set req.url = req.url.path "index.html";
  }

  return(lookup);
}
