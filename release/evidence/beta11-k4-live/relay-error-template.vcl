if (obj.status == 601 || obj.status == 602) {
 set obj.status = 401;
 synthetic "unauthorized";
 return(deliver);
}
