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
/* === Configuraciones CLI por dispositivo ===
Copiar y pegar en la CLI de cada dispositivo. */
/* --- R_HOME ---
enable
configure terminal
hostname R_HOME
no ip domain-lookup

interface GigabitEthernet0/0
 ip address 203.0.113.10 255.255.255.252
 no shutdown
 exit

interface GigabitEthernet0/1
 ip address 192.168.1.1 255.255.255.0
 no shutdown
 exit

ip dhcp excluded-address 192.168.1.1 192.168.1.10
ip dhcp pool LAN_HOME
 network 192.168.1.0 255.255.255.0
 default-router 192.168.1.1
 dns-server 8.8.8.8
 exit

interface GigabitEthernet0/0
 ip nat outside
 exit

interface GigabitEthernet0/1
 ip nat inside
 exit

access-list 1 permit 192.168.1.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/0 overload

ip route 0.0.0.0 0.0.0.0 203.0.113.9

end
write memory
*/ 
/* --- SW_HOME ---
enable
configure terminal
hostname SW_HOME
end
write memory
*/ 
/* --- R_ISP ---
enable
configure terminal
hostname R_ISP
no ip domain-lookup

interface GigabitEthernet0/0
 ip address 203.0.113.9 255.255.255.252
 no shutdown
 exit

interface GigabitEthernet0/1
 ip address 198.51.100.1 255.255.255.252
 no shutdown
 exit

interface GigabitEthernet0/2
 ip address 203.0.113.17 255.255.255.252
 no shutdown
 exit

router ospf 1
 router-id 1.1.1.1
 network 203.0.113.8 0.0.0.3 area 0
 network 198.51.100.0 0.0.0.3 area 0
 network 203.0.113.16 0.0.0.3 area 0
 exit

end
write memory
*/ 
/* --- R_AWS ---
enable
configure terminal
hostname R_AWS
no ip domain-lookup

interface GigabitEthernet0/0
 ip address 198.51.100.2 255.255.255.252
 no shutdown
 exit

interface GigabitEthernet0/1
 ip address 172.31.0.1 255.255.255.0
 no shutdown
 exit

router ospf 1
 router-id 2.2.2.2
 network 198.51.100.0 0.0.0.3 area 0
 network 172.31.0.0 0.0.0.255 area 0
 exit

end
write memory
*/ 
/* --- SW_AWS ---
enable
configure terminal
hostname SW_AWS
end
write memory
*/ 
/* --- R_REMOTE ---
enable
configure terminal
hostname R_REMOTE
no ip domain-lookup

interface GigabitEthernet0/0
 ip address 203.0.113.18 255.255.255.252
 no shutdown
 exit

interface GigabitEthernet0/1
 ip address 192.168.2.1 255.255.255.0
 no shutdown
 exit

ip dhcp excluded-address 192.168.2.1 192.168.2.10
ip dhcp pool LAN_REMOTE
 network 192.168.2.0 255.255.255.0
 default-router 192.168.2.1
 dns-server 8.8.8.8
 exit

interface GigabitEthernet0/0
 ip nat outside
 exit

interface GigabitEthernet0/1
 ip nat inside
 exit

access-list 1 permit 192.168.2.0 0.0.0.255
ip nat inside source list 1 interface GigabitEthernet0/0 overload

ip route 0.0.0.0 0.0.0.0 203.0.113.17

end
write memory
*/ 
/* --- SW_REMOTE ---
enable
configure terminal
hostname SW_REMOTE
end
write memory
*/

// Auto-save topology to .pkt file
try {
    var aw = ipc.appWindow();
    if (aw) {
        aw.fileSaveAsNoPrompt("C:/PROJECTS/CopySync/packet_tracer/CopySync_PacketTracer/CopySync_Network_Simulation.pkt", false);
    }
} catch(e) {} 