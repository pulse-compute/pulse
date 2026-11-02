if (!req.backend.is_shield) {
 set beresp.http.X-Pulse-K4-Pop = server.datacenter;
 set beresp.http.X-Pulse-K4-Request = uuid.version4();
 set beresp.http.X-Pulse-K4-Service = "__SERVICE__";
 set beresp.http.X-Pulse-K4-Version = "1";
 set beresp.http.X-Pulse-K4-Store = "__STORE__";
 set beresp.http.X-Pulse-K4-Module = "__MODULE__";
 set beresp.http.X-Pulse-K4-Compute-Served-By = beresp.http.X-Served-By;
}
set beresp.ttl = 0s;
return(pass);
