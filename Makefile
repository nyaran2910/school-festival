PHONE_CONTROLLER_UNITY_CONFIG := ../unity/Assets/StreamingAssets/controller-connection.json
PHONE_CONTROLLER_IMAGE ?= nyaran336699/kosen-chanbara-phone-controller:latest

export PHONE_CONTROLLER_IMAGE

.PHONY: phone-controller phone-controller-stop phone-controller-status phone-controller-logs

phone-controller:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) docker-up

phone-controller-stop:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) docker-stop

phone-controller-status:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) docker-status

phone-controller-logs:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) docker-logs
