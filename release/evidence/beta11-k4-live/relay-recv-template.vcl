if (req.http.x-pulse-k4-auth != "__AUTH__") { error 601 "Unauthorized"; }
if (req.method != "POST") { error 602 "POST required"; }
set var.fastly_req_do_shield = true;
