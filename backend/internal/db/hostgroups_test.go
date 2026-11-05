package db

import "testing"

func TestHostKey(t *testing.T) {
	cases := []struct{ host, port, want string }{
		{"http://123ev.vip:80", "", "123ev.vip:80"},
		{"http://123ev.vip", "80", "123ev.vip:80"},
		{"123ev.vip", "", "123ev.vip:80"},
		{"HTTP://123EV.VIP/", "", "123ev.vip:80"},
		{"http://dreamdns.ddns.me:8080", "", "dreamdns.ddns.me:8080"},
		{"http://dreamdns.ddns.me", "8080", "dreamdns.ddns.me:8080"},
		{"https://painel.tv", "", "painel.tv:443"},
		{"http://painel.tv:8080/get.php?x=1", "", "painel.tv:8080"},
		{" painel.tv ", " 25461 ", "painel.tv:25461"},
	}
	for _, c := range cases {
		if got := HostKey(c.host, c.port); got != c.want {
			t.Errorf("HostKey(%q, %q) = %q, quer %q", c.host, c.port, got, c.want)
		}
	}
	if HostKey("http://a.tv", "8080") == HostKey("http://a.tv", "80") {
		t.Error("portas diferentes não podem cair no mesmo grupo")
	}
}
