package com.clipsync;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Main Spring Boot application entry point for ClipSync.
 * Serves as the configuration context for Spring Cloud Function routing.
 */
@SpringBootApplication
public class ClipSyncApplication {

    public static void main(String[] args) {
        SpringApplication.run(ClipSyncApplication.class, args);
    }
}
