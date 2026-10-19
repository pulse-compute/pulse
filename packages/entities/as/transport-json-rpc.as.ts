function __pulse_transport_response(): i32 {
  const response = entity_host_object()
  entity_host_set(response, __pulse_package_string('status'), entity_host_number(<f64>__pulse_entities_response_status))
  entity_host_set(response, __pulse_package_string('body'), __pulse_package_string(__pulse_entities_response))
  if (__pulse_entities_response_status != 204) {
    const headers = entity_host_object()
    entity_host_set(headers, __pulse_package_string('content-type'), __pulse_package_string('application/json; charset=utf-8'))
    entity_host_set(response, __pulse_package_string('headers'), headers)
  }
  return entity_host_response(response)
}
function __pulse_transport_start(): i32 {
  const request = JSON.parse<string>(changetype<string>(entity_host_json(entity_host_request())))
  pulse_entities_set_request(changetype<i32>(request))
  return __pulse_package_finish(pulse_entities_start())
}
