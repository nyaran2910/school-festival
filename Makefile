PHONE_CONTROLLER_UNITY_CONFIG := ../unity/Assets/StreamingAssets/controller-connection.json

.PHONY: phone-controller phone-controller-stop phone-controller-status phone-controller-logs

phone-controller:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) local

phone-controller-stop:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) stop

phone-controller-status:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) status

phone-controller-logs:
	@$(MAKE) -C apps/phone UNITY_CONFIG=$(PHONE_CONTROLLER_UNITY_CONFIG) logs
