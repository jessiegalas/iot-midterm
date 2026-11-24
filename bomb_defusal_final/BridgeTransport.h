#pragma once

#include <Arduino.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>
#include <atomic>

#if __has_include("bridge_local.h")
#include "bridge_local.h"
#else
#include "bridge_local.example.h"
#endif

namespace BridgeTransport {
enum Source { USB, WIFI };
constexpr size_t FRAME_SIZE = 192;
constexpr uint16_t PORT = 8443;

struct Frame {
  unsigned generation = 0;
  char text[FRAME_SIZE]{};
};

struct LineReader {
  Frame frame;
  size_t length = 0;
  bool discard = false;

  bool add(char ch) {
    if (ch == '\r') return false;
    if (ch == '\n') {
      bool complete = !discard && length > 0;
      frame.text[length] = '\0';
      length = 0;
      discard = false;
      return complete;
    }
    if (ch < 32 || ch > 126 || length == FRAME_SIZE - 1) discard = true;
    if (!discard) frame.text[length++] = ch;
    return false;
  }
};

QueueHandle_t incoming = nullptr;
QueueHandle_t outgoing = nullptr;
std::atomic<unsigned> connectedGeneration{0};
std::atomic<bool> overflow{false};

void wifiWorker(void*) {
  IPAddress laptopAddress;
  laptopAddress.fromString(BRIDGE_LAPTOP_IP);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(BRIDGE_WIFI_SSID, BRIDGE_WIFI_PASSWORD);
  unsigned generation = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    NetworkClientSecure client;
    client.setHandshakeTimeout(3);
    client.setPreSharedKey(BRIDGE_PSK_ID, BRIDGE_PSK_HEX);
    // The PSK overload prepares TLS on connect. Complete the handshake before any frame I/O.
    client.setPlainStart();
    if (client.connect(laptopAddress, PORT, 3000) && client.startTLS()) {
      if (++generation == 0) ++generation;
      client.setNoDelay(true);
      LineReader reader;
      reader.frame.generation = generation;
      overflow = false;
      connectedGeneration = generation;
      while (WiFi.status() == WL_CONNECTED && client.connected() && !overflow) {
        for (int count = 0; count < 256 && client.available(); ++count) {
          int value = client.read();
          if (value < 0) break;
          if (reader.add(static_cast<char>(value)) && xQueueSend(incoming, &reader.frame, 0) != pdTRUE) {
            overflow = true;
            break;
          }
        }
        Frame response;
        for (int count = 0; count < 8 && xQueueReceive(outgoing, &response, 0) == pdTRUE; ++count) {
          if (response.generation == generation && client.println(response.text) != strlen(response.text) + 2) {
            overflow = true;
            break;
          }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
      }
      connectedGeneration = 0;
      xQueueReset(outgoing);
    }
    client.stop();
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void begin() {
  if (!BRIDGE_WIFI_SSID[0] || !BRIDGE_LAPTOP_IP[0] || !BRIDGE_PSK_ID[0] || strlen(BRIDGE_PSK_HEX) != 64) return;
  IPAddress laptopAddress;
  if (!laptopAddress.fromString(BRIDGE_LAPTOP_IP)) return;
  incoming = xQueueCreate(16, sizeof(Frame));
  outgoing = xQueueCreate(16, sizeof(Frame));
  if (!incoming || !outgoing || xTaskCreate(wifiWorker, "bridge-wifi", 8192, nullptr, 1, nullptr) != pdPASS) {
    if (incoming) vQueueDelete(incoming);
    if (outgoing) vQueueDelete(outgoing);
    incoming = outgoing = nullptr;
    Serial.println("Wi-Fi bridge unavailable; USB is available.");
  }
}

void send(Source source, const char* text) {
  if (source == USB) {
    Serial.println(text);
    return;
  }
  const unsigned generation = connectedGeneration;
  if (!generation) return;
  Frame frame;
  frame.generation = generation;
  snprintf(frame.text, sizeof(frame.text), "%s", text);
  if (xQueueSend(outgoing, &frame, 0) != pdTRUE) overflow = true;
}

bool receiveWifi(Frame& frame) {
  return incoming && xQueueReceive(incoming, &frame, 0) == pdTRUE;
}
}
