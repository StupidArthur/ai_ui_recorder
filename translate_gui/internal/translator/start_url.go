package translator

import (
	"net/url"
	"strings"
)

var sensitiveURLQueryKeys = map[string]struct{}{
	"token": {}, "tpt-token": {}, "tpt_token": {}, "auth_token": {}, "auth-token": {},
	"access_token": {}, "access-token": {}, "refresh_token": {}, "refresh-token": {}, "id_token": {}, "id-token": {},
	"auth": {}, "authorization": {}, "session": {}, "sessionid": {}, "session_id": {}, "session-id": {}, "sid": {},
	"code": {}, "secret": {}, "client_secret": {}, "client-secret": {}, "api_key": {}, "api-key": {}, "password": {}, "passwd": {},
	"csrf": {}, "csrf_token": {}, "csrf-token": {}, "xsrf": {}, "xsrf_token": {}, "xsrf-token": {}, "ticket": {},
}

// resolveSanitizedStartURL prefers the run metadata URL and falls back to the
// first recorded step URL. Invalid or unsafe URLs are omitted from outputs.
func resolveSanitizedStartURL(runDir string, steps []StructuredStep) string {
	raw := readTargetURLFromMeta(runDir)
	if raw == "" {
		for _, step := range steps {
			if strings.TrimSpace(step.URL) != "" {
				raw = strings.TrimSpace(step.URL)
				break
			}
		}
	}
	return sanitizeStartURL(raw)
}

// sanitizeStartURL removes credential-like URL fields while retaining ordinary
// query parameters and application hash routes. Parsing failures fail closed.
func sanitizeStartURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	parsed.User = nil

	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return ""
	}
	removeSensitiveURLQueryKeys(query)
	parsed.RawQuery = query.Encode()
	if len(query) == 0 {
		parsed.ForceQuery = false
	}

	fragment, ok := sanitizeURLFragment(parsed.Fragment)
	if !ok {
		return ""
	}
	parsed.Fragment = fragment
	return parsed.String()
}

func sanitizeURLFragment(fragment string) (string, bool) {
	queryStart := strings.Index(fragment, "?")
	if queryStart >= 0 {
		query, err := url.ParseQuery(fragment[queryStart+1:])
		if err != nil {
			return "", false
		}
		removeSensitiveURLQueryKeys(query)
		route := fragment[:queryStart]
		if len(query) == 0 {
			return route, true
		}
		return route + "?" + query.Encode(), true
	}

	// OAuth-style hash fragments can carry query parameters without a route.
	// Leave ordinary fragments untouched unless a sensitive key is present.
	if strings.Contains(fragment, "=") && !strings.Contains(fragment, "/") {
		query, err := url.ParseQuery(fragment)
		if err != nil {
			return "", false
		}
		originalCount := len(query)
		removeSensitiveURLQueryKeys(query)
		if len(query) != originalCount {
			return query.Encode(), true
		}
	}
	return fragment, true
}

func removeSensitiveURLQueryKeys(query url.Values) {
	for key := range query {
		normalized := strings.ToLower(strings.TrimSpace(key))
		if _, sensitive := sensitiveURLQueryKeys[normalized]; sensitive {
			delete(query, key)
		}
	}
}
