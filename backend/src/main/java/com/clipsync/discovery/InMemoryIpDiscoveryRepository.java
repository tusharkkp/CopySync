package com.clipsync.discovery;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public class InMemoryIpDiscoveryRepository implements IpDiscoveryRepository {

    private final Map<String, IpDiscoveryRecord> store = new ConcurrentHashMap<>();

    @Override
    public void save(IpDiscoveryRecord record) {
        store.put(record.ipHash(), record);
    }

    @Override
    public Optional<IpDiscoveryRecord> findByIpHash(String ipHash) {
        IpDiscoveryRecord record = store.get(ipHash);
        if (record == null) {
            return Optional.empty();
        }
        if (record.isExpired()) {
            store.remove(ipHash);
            return Optional.empty();
        }
        return Optional.of(record);
    }

    @Override
    public void delete(String ipHash) {
        store.remove(ipHash);
    }
}
