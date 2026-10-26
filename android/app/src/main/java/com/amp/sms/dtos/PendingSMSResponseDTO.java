package com.amp.sms.dtos;

import com.amp.sms.models.SMSPayload;

import java.util.List;

/** { "data": [ ...messages the server just handed us... ] } */
public class PendingSMSResponseDTO {
    private List<SMSPayload> data;

    public List<SMSPayload> getData() {
        return data;
    }

    public void setData(List<SMSPayload> data) {
        this.data = data;
    }
}
