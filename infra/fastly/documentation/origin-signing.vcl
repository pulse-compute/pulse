# Pulse documentation Fastly Object Storage signer
# Placement: vcl_miss.
#
# Derived from Fastly's documented SigV4 private-origin pattern. Inject the
# four FOS_* values in the Fastly service configuration. Never commit live
# credentials. Use a bucket-limited, read-only Object Storage key here.

declare local var.fosAccessKey STRING;
declare local var.fosSecretKey STRING;
declare local var.fosBucket STRING;
declare local var.fosRegion STRING;
declare local var.fosHost STRING;
declare local var.canonicalHeaders STRING;
declare local var.signedHeaders STRING;
declare local var.canonicalRequest STRING;
declare local var.canonicalQuery STRING;
declare local var.stringToSign STRING;
declare local var.dateStamp STRING;
declare local var.signature STRING;
declare local var.scope STRING;

# --- INJECT THROUGH THE FASTLY SERVICE; DO NOT COMMIT REAL VALUES ---
set var.fosAccessKey = "FOS_READ_ONLY_ACCESS_KEY";
set var.fosSecretKey = "FOS_READ_ONLY_SECRET_KEY";
set var.fosBucket = "FOS_DOCUMENTATION_BUCKET";
set var.fosRegion = "FOS_REGION";
# -------------------------------------------------------------------

set var.fosHost = var.fosRegion ".object.fastlystorage.app";

if (req.http.Pulse-Documentation == "1" &&
    (req.method == "GET" || req.method == "HEAD") &&
    !req.backend.is_shield) {
  set bereq.http.x-amz-content-sha256 = digest.hash_sha256("");
  set bereq.http.x-amz-date = strftime({"%Y%m%dT%H%M%SZ"}, now);
  set bereq.http.host = var.fosHost;

  # Fastly Object Storage uses path-style bucket addressing. The generated
  # public path already starts with /pulse, which is the object prefix.
  set bereq.url = "/" var.fosBucket bereq.url;
  set bereq.url = querystring.remove(bereq.url);
  # Preserve literal plus characters before normalizing the canonical path.
  set bereq.url = regsuball(bereq.url, "\\+", urlencode("+"));
  set bereq.url = regsuball(urlencode(urldecode(bereq.url.path)), {"%2F"}, "/");

  set var.dateStamp = strftime({"%Y%m%d"}, now);
  set var.canonicalHeaders = ""
    "host:" bereq.http.host LF
    "x-amz-content-sha256:" bereq.http.x-amz-content-sha256 LF
    "x-amz-date:" bereq.http.x-amz-date LF
  ;
  set var.canonicalQuery = "";
  set var.signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  set var.canonicalRequest = ""
    bereq.method LF
    bereq.url.path LF
    var.canonicalQuery LF
    var.canonicalHeaders LF
    var.signedHeaders LF
    digest.hash_sha256("")
  ;
  set var.scope = var.dateStamp "/" var.fosRegion "/s3/aws4_request";
  set var.stringToSign = ""
    "AWS4-HMAC-SHA256" LF
    bereq.http.x-amz-date LF
    var.scope LF
    regsub(digest.hash_sha256(var.canonicalRequest), "^0x", "")
  ;
  set var.signature = digest.awsv4_hmac(
    var.fosSecretKey,
    var.dateStamp,
    var.fosRegion,
    "s3",
    var.stringToSign
  );
  set bereq.http.Authorization = "AWS4-HMAC-SHA256 "
    "Credential=" var.fosAccessKey "/" var.scope ", "
    "SignedHeaders=" var.signedHeaders ", "
    "Signature=" + regsub(var.signature, "^0x", "")
  ;

  unset bereq.http.Accept;
  unset bereq.http.Accept-Language;
  unset bereq.http.User-Agent;
  unset bereq.http.Fastly-Client-IP;
}
