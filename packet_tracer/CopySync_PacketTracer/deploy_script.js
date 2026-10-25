lwAddDevice("R_HOME", 0, "2911", 150, 100);
lwAddDevice("SW_HOME", 1, "2960-24TT", 150, 250);
lwAddDevice("AP_HOME", 7, "AccessPoint-PT", 250, 330);
lwAddDevice("Laptop_A", 17, "Laptop-PT", 80, 420);
lwAddDevice("Laptop_B", 17, "Laptop-PT", 180, 420);
lwAddDevice("R_ISP", 0, "2911", 450, 100);
lwAddDevice("R_AWS", 0, "2911", 450, 250);
lwAddDevice("SW_AWS", 1, "2960-24TT", 450, 360);
lwAddDevice("AWS_Relay", 9, "Server-PT", 380, 470);
lwAddDevice("STUN_Server", 9, "Server-PT", 520, 470);
lwAddDevice("R_REMOTE", 0, "2911", 750, 100);
lwAddDevice("SW_REMOTE", 1, "2960-24TT", 750, 250);
lwAddDevice("Laptop_C", 17, "Laptop-PT", 750, 420);
swapLaptopToWireless("Laptop_A");
swapLaptopToWireless("Laptop_B");
lwAddLink("R_HOME", "GigabitEthernet0/0", "R_ISP", "GigabitEthernet0/0", 8101);
lwAddLink("R_ISP", "GigabitEthernet0/1", "R_AWS", "GigabitEthernet0/0", 8101);
lwAddLink("R_ISP", "GigabitEthernet0/2", "R_REMOTE", "GigabitEthernet0/0", 8101);
lwAddLink("R_HOME", "GigabitEthernet0/1", "SW_HOME", "GigabitEthernet0/1", 8100);
lwAddLink("SW_HOME", "FastEthernet0/1", "AP_HOME", "Port 0", 8100);
lwAddLink("SW_HOME", "FastEthernet0/2", "Laptop_A", "FastEthernet0", 8100);
lwAddLink("SW_HOME", "FastEthernet0/3", "Laptop_B", "FastEthernet0", 8100);
lwAddLink("R_AWS", "GigabitEthernet0/1", "SW_AWS", "GigabitEthernet0/1", 8100);
lwAddLink("SW_AWS", "FastEthernet0/1", "AWS_Relay", "FastEthernet0", 8100);
lwAddLink("SW_AWS", "FastEthernet0/2", "STUN_Server", "FastEthernet0", 8100);
lwAddLink("R_REMOTE", "GigabitEthernet0/1", "SW_REMOTE", "GigabitEthernet0/1", 8100);
lwAddLink("SW_REMOTE", "FastEthernet0/1", "Laptop_C", "FastEthernet0", 8100);
configureIosDevice("R_HOME", "enable\nconfigure terminal\nhostname R_HOME\nno ip domain-lookup\n\ninterface GigabitEthernet0/0\n ip address 203.0.113.10 255.255.255.252\n ip nat outside\n no shutdown\n exit\n\ninterface GigabitEthernet0/1\n ip address 192.168.1.1 255.255.255.0\n ip nat inside\n no shutdown\n exit\n\nip dhcp excluded-address 192.168.1.1 192.168.1.10\nip dhcp pool LAN_HOME\n network 192.168.1.0 255.255.255.0\n default-router 192.168.1.1\n dns-server 8.8.8.8\n exit\n\naccess-list 1 permit 192.168.1.0 0.0.0.255\nip nat inside source list 1 interface GigabitEthernet0/0 overload\n\nip route 0.0.0.0 0.0.0.0 203.0.113.9\n\nend\nwrite memory");
configureIosDevice("SW_HOME", "enable\nconfigure terminal\nhostname SW_HOME\nend\nwrite memory");
configureIosDevice("R_ISP", "enable\nconfigure terminal\nhostname R_ISP\nno ip domain-lookup\n\ninterface GigabitEthernet0/0\n ip address 203.0.113.9 255.255.255.252\n no shutdown\n exit\n\ninterface GigabitEthernet0/1\n ip address 198.51.100.1 255.255.255.252\n no shutdown\n exit\n\ninterface GigabitEthernet0/2\n ip address 203.0.113.17 255.255.255.252\n no shutdown\n exit\n\nrouter ospf 1\n router-id 1.1.1.1\n network 203.0.113.8 0.0.0.3 area 0\n network 198.51.100.0 0.0.0.3 area 0\n network 203.0.113.16 0.0.0.3 area 0\n exit\n\nend\nwrite memory");
configureIosDevice("R_AWS", "enable\nconfigure terminal\nhostname R_AWS\nno ip domain-lookup\n\ninterface GigabitEthernet0/0\n ip address 198.51.100.2 255.255.255.252\n no shutdown\n exit\n\ninterface GigabitEthernet0/1\n ip address 172.31.0.1 255.255.255.0\n no shutdown\n exit\n\nrouter ospf 1\n router-id 2.2.2.2\n network 198.51.100.0 0.0.0.3 area 0\n network 172.31.0.0 0.0.0.255 area 0\n exit\n\nend\nwrite memory");
configureIosDevice("SW_AWS", "enable\nconfigure terminal\nhostname SW_AWS\nend\nwrite memory");
configureIosDevice("R_REMOTE", "enable\nconfigure terminal\nhostname R_REMOTE\nno ip domain-lookup\n\ninterface GigabitEthernet0/0\n ip address 203.0.113.18 255.255.255.252\n ip nat outside\n no shutdown\n exit\n\ninterface GigabitEthernet0/1\n ip address 192.168.2.1 255.255.255.0\n ip nat inside\n no shutdown\n exit\n\nip dhcp excluded-address 192.168.2.1 192.168.2.10\nip dhcp pool LAN_REMOTE\n network 192.168.2.0 255.255.255.0\n default-router 192.168.2.1\n dns-server 8.8.8.8\n exit\n\naccess-list 1 permit 192.168.2.0 0.0.0.255\nip nat inside source list 1 interface GigabitEthernet0/0 overload\n\nip route 0.0.0.0 0.0.0.0 203.0.113.17\n\nend\nwrite memory");
configureIosDevice("SW_REMOTE", "enable\nconfigure terminal\nhostname SW_REMOTE\nend\nwrite memory");
configurePcIp("Laptop_A", true);
configurePcIp("Laptop_B", false, "192.168.1.102", "255.255.255.0", "192.168.1.1");
configurePcIp("AWS_Relay", true);
configurePcIp("STUN_Server", false, "172.31.0.60", "255.255.255.0", "172.31.0.1");
configurePcIp("Laptop_C", false, "192.168.2.101", "255.255.255.0", "192.168.2.1");

// Auto-save topology to .pkt file
try {
    var aw = ipc.appWindow();
    if (aw) {
        aw.fileSaveAsNoPrompt("C:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/CopySync_Network_Simulation.pkt", false);
    }
} catch(e) {}