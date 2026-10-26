package com.amp.sms.services;

import com.amp.sms.dtos.SMSDTO;
import com.amp.sms.dtos.SMSForwardResponseDTO;
import com.amp.sms.dtos.PendingSMSResponseDTO;
import com.amp.sms.dtos.RegisterDeviceInputDTO;
import com.amp.sms.dtos.RegisterDeviceResponseDTO;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.Header;
import retrofit2.http.PATCH;
import retrofit2.http.GET;
import retrofit2.http.POST;
import retrofit2.http.Path;

public interface GatewayApiService {
    @POST("gateway/devices")
    Call<RegisterDeviceResponseDTO> registerDevice(@Header("x-api-key") String apiKey, @Body() RegisterDeviceInputDTO body);

    @PATCH("gateway/devices/{deviceId}")
    Call<RegisterDeviceResponseDTO> updateDevice(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() RegisterDeviceInputDTO body);

    @GET("gateway/devices/{deviceId}/pending-sms")
    Call<PendingSMSResponseDTO> getPendingSMS(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey);

    @POST("gateway/devices/{deviceId}/receive-sms")
    Call<SMSForwardResponseDTO> sendReceivedSMS(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() SMSDTO body);

    @PATCH("gateway/devices/{deviceId}/sms-status")
    Call<SMSForwardResponseDTO> updateSMSStatus(@Path("deviceId") String deviceId, @Header("x-api-key") String apiKey, @Body() SMSDTO body);
}